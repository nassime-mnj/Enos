"""HTTPS local pour l'acces telephone : mini-autorite « N.A.S.K.O Local CA » + certificat serveur signe par elle.

Pourquoi : un certificat auto-signe affiche « Votre connexion n'est pas privee » a chaque visite, et empeche
l'installation en application. En installant UNE FOIS le certificat de l'autorite (nasko-ca.crt) sur le telephone,
le navigateur fait confiance au PC : plus d'avertissement, micro et « appli » fonctionnent normalement.

Securite : l'autorite est limitee (« name constraints ») aux reseaux prives (10.x, 172.16-31.x, 192.168.x, 127.x) et a
« localhost ». Meme si sa cle privee fuitait, elle ne pourrait certifier aucun site Internet.
"""
import datetime
import ipaddress
import logging
import os

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

log = logging.getLogger("nasko.cert")

BROWSER_WARNING = ("Sans le certificat E.N.O.S. installé sur le téléphone, le navigateur affichera « Votre connexion "
                   "n'est pas privée » : appuyez sur « Avancé » puis « Continuer ». Pour ne plus jamais le voir, "
                   "installez nasko-ca.crt (voir GUIDE.md).")

PRIVATE_NETS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"]
VPN_NET = "100.64.0.0/10"            # adresses des VPN type Tailscale ; ajoutee seulement si allow_vpn_ranges = true


def nets(vpn):
    return PRIVATE_NETS + ([VPN_NET] if vpn else [])
CA_YEARS, LEAF_DAYS, RENEW_DAYS = 10, 397, 30


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _expiry(cert):
    return getattr(cert, "not_valid_after_utc", None) or cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)


def _san_ips(cert):
    try:
        ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
    except x509.ExtensionNotFound:
        return set()
    return {str(ip) for ip in ext.value.get_values_for_type(x509.IPAddress)}


def _load(path, kind):
    with open(path, "rb") as f:
        data = f.read()
    return x509.load_pem_x509_certificate(data) if kind == "cert" else serialization.load_pem_private_key(data, None)


def _write_pem(path, obj):
    with open(path, "wb") as f:
        if isinstance(obj, x509.Certificate):
            f.write(obj.public_bytes(serialization.Encoding.PEM))
        else:
            f.write(obj.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                      serialization.NoEncryption()))


def _ca_has_vpn(cert):
    try:
        nc = cert.extensions.get_extension_for_class(x509.NameConstraints).value
        return any(isinstance(s, x509.IPAddress) and str(s.value) == VPN_NET for s in nc.permitted_subtrees)
    except x509.ExtensionNotFound:
        return False


def _ensure_ca(folder, vpn=False):
    """Retourne (ca_cert, ca_key) ; cree l'autorite au premier usage (10 ans).
    Si `vpn` est demande et que l'autorite actuelle n'autorise pas 100.64.0.0/10, elle est REEMISE (a reinstaller sur les telephones)."""
    cert_p, key_p = os.path.join(folder, "nasko_ca.pem"), os.path.join(folder, "nasko_ca_key.pem")
    if os.path.isfile(cert_p) and os.path.isfile(key_p):
        try:
            cert = _load(cert_p, "cert")
            if _expiry(cert) > _now() + datetime.timedelta(days=RENEW_DAYS) and (_ca_has_vpn(cert) or not vpn):
                return cert, _load(key_p, "key")
        except (ValueError, OSError):
            pass
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, "N.A.S.K.O"),
                      x509.NameAttribute(NameOID.COMMON_NAME, "N.A.S.K.O Local CA")])
    constraints = x509.NameConstraints(
        permitted_subtrees=[x509.IPAddress(ipaddress.ip_network(n)) for n in nets(vpn)] + [x509.DNSName("localhost")],
        excluded_subtrees=None)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(_now() - datetime.timedelta(days=1))
            .not_valid_after(_now() + datetime.timedelta(days=365 * CA_YEARS))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
            .add_extension(constraints, critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .sign(key, hashes.SHA256()))
    _write_pem(cert_p, cert)
    _write_pem(key_p, key)
    log.info("Autorite locale E.N.O.S. generee (a installer une fois sur le telephone)")
    return cert, key


def ensure_cert(ips, hostname, folder, vpn=False):
    """Retourne (certfile, keyfile) du serveur HTTPS. Reutilise le certificat tant qu'il est signe par l'autorite
    actuelle, couvre les IP du PC et n'expire pas dans moins de 30 jours."""
    os.makedirs(folder, exist_ok=True)
    ca, ca_key = _ensure_ca(folder, vpn)
    cert_p, key_p = os.path.join(folder, "nasko_cert.pem"), os.path.join(folder, "nasko_key.pem")
    allowed = [ipaddress.ip_network(n) for n in nets(_ca_has_vpn(ca))]          # ce que CETTE autorite peut certifier
    wanted = {"127.0.0.1"} | {ip for ip in ips if any(ipaddress.ip_address(ip) in n for n in allowed)}   # uniquement ce que l'autorité peut certifier
    if os.path.isfile(cert_p) and os.path.isfile(key_p):
        try:
            leaf = _load(cert_p, "cert")
            leaf.verify_directly_issued_by(ca)
            if wanted <= _san_ips(leaf) and _expiry(leaf) > _now() + datetime.timedelta(days=RENEW_DAYS):
                return cert_p, key_p
        except Exception:        # ancien certificat auto-signe, autre autorite, fichier abime : on regenere
            pass
    key = ec.generate_private_key(ec.SECP256R1())
    san = [x509.DNSName("localhost")] + [x509.IPAddress(ipaddress.ip_address(ip)) for ip in sorted(wanted)]
    leaf = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "N.A.S.K.O")]))
            .issuer_name(ca.subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(_now() - datetime.timedelta(days=1))
            .not_valid_after(_now() + datetime.timedelta(days=LEAF_DAYS))
            .add_extension(x509.SubjectAlternativeName(san), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca.public_key()), critical=False)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256()))
    _write_pem(cert_p, leaf)
    _write_pem(key_p, key)
    log.info("Certificat serveur signe par l'autorite locale pour %s", sorted(wanted))
    return cert_p, key_p


def fingerprint(folder):
    """Empreinte SHA-256 du certificat serveur (AA:BB:...), celle que l'application Android demande de valider. '' si absent."""
    path = os.path.join(folder, "nasko_cert.pem")
    try:
        cert = _load(path, "cert")
        return ":".join(f"{b:02X}" for b in cert.fingerprint(hashes.SHA256()))
    except Exception:
        return ""


def ca_der(folder, vpn=False):
    """Certificat de l'autorite au format DER (.crt) a installer sur le telephone ; cree l'autorite si besoin."""
    ca, _ = _ensure_ca(folder, vpn)
    return ca.public_bytes(serialization.Encoding.DER)
