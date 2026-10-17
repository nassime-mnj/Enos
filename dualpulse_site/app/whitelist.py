"""Whitelist IP « accès développeur » : normalisation, CIDR, extraction de l'IP réelle du visiteur (proxy inverse maîtrisé)."""
import ipaddress
import os

Addr = ipaddress.IPv4Address | ipaddress.IPv6Address


def normalize(value: str):
    """'1.2.3.4', '::ffff:1.2.3.4', '2001:db8::1' -> objet ip_address ; None si invalide."""
    try:
        ip = ipaddress.ip_address((value or "").strip().strip("[]"))
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        return ip.ipv4_mapped
    return ip


def parse_entry(value: str):
    """Entrée de liste blanche : une IP ('1.2.3.4') ou un réseau CIDR ('203.0.113.0/28' pour un bureau). Retourne la forme canonique ou None."""
    v = (value or "").strip()
    if not v or len(v) > 64:
        return None
    if "/" in v:
        try:
            net = ipaddress.ip_network(v, strict=False)
        except ValueError:
            return None
        if net.prefixlen < (16 if net.version == 4 else 48):        # refuse les réseaux énormes (ex. 0.0.0.0/0 ouvrirait l'accès à tout le monde)
            return None
        return str(net)
    ip = normalize(v)
    return str(ip) if ip else None


def matches(entry: str, ip) -> bool:
    if ip is None:
        return False
    try:
        if "/" in entry:
            net = ipaddress.ip_network(entry, strict=False)
            return ip.version == net.version and ip in net
        return normalize(entry) == ip
    except ValueError:
        return False


def trusted_proxies():
    return [p.strip() for p in os.environ.get("DP_TRUSTED_PROXIES", "").split(",") if p.strip()]


def client_ip(request):
    """IP du visiteur. X-Forwarded-For n'est lu QUE si la connexion directe vient d'un proxy déclaré (DP_TRUSTED_PROXIES) ; on remonte la chaîne
    depuis la droite en sautant les proxys de confiance : un visiteur ne peut pas se faire passer pour une IP autorisée en forgeant l'en-tête."""
    peer = normalize(request.client.host if request.client else "")
    if peer is not None and peer.is_loopback:                 # tunnel public (localhost.run…) : le trafic arrive de 127.0.0.1 mais n'est PAS local
        host = request.headers.get("host", "").rsplit(":", 1)[0].strip("[]").lower()
        if host not in ("127.0.0.1", "localhost", "::1") or any(h in request.headers for h in ("x-forwarded-for", "forwarded", "x-real-ip")):
            return None
    proxies = trusted_proxies()
    if peer is None or not proxies or not any(matches(p if "/" in p else p, peer) for p in proxies):
        return peer
    chain = [normalize(x) for x in request.headers.get("x-forwarded-for", "").split(",") if x.strip()]
    for hop in reversed(chain):
        if hop is None:
            return peer
        if not any(matches(p, hop) for p in proxies):
            return hop
    return chain[0] if chain and chain[0] else peer
