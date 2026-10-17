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


TAILSCALE_NETS = (ipaddress.ip_network("100.64.0.0/10"), ipaddress.ip_network("fd7a:115c:a1e0::/48"))      # adresses attribuées par Tailscale


def _in_tailscale(ip):
    return ip is not None and any(ip.version == net.version and ip in net for net in TAILSCALE_NETS)


def forwarded_ip(request):
    """Premier saut de X-Forwarded-For (l'appareil Tailscale qui a fait la requête quand elle passe par `tailscale serve`), sinon None."""
    first = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return normalize(first) if first else None


def tailscale_user(request):
    """Login Tailscale de l'appelant quand la requête arrive par `tailscale serve`, s'il est autorisé à l'accès développeur ; sinon None.

    client_ip() refuse (à raison) de traiter le trafic d'un tunnel comme local : `tailscale serve` arrive de 127.0.0.1 avec un Host et un X-Forwarded-For étrangers. Ce chemin-ci est
    donc une EXCEPTION volontaire, étroite : elle exige TOUT ceci —
      * DP_TAILSCALE_HOST (nom MagicDNS du serveur, ex. sami.tail8e71e8.ts.net) ET DP_TAILSCALE_USERS (logins autorisés, ou *) sont définis ;
      * la connexion directe vient de la boucle locale (c'est tailscaled qui relaie) ;
      * l'en-tête Host est exactement ce nom : un autre tunnel (localhost.run…) arrive avec SON nom d'hôte et échoue ici, même s'il forge l'en-tête d'identité ;
      * X-Forwarded-For désigne une adresse du réseau Tailscale (100.64.0.0/10) ;
      * l'en-tête Tailscale-User-Login (ajouté par tailscaled, que le client ne peut pas imposer) est présent et fait partie des logins autorisés."""
    allowed = {u.strip().lower() for u in os.environ.get("DP_TAILSCALE_USERS", "").split(",") if u.strip()}
    want_host = os.environ.get("DP_TAILSCALE_HOST", "").strip().lower().rstrip(".")
    if not allowed or not want_host:
        return None
    peer = normalize(request.client.host if request.client else "")
    # Le pair est la boucle locale (tailscaled relaie) OU une adresse Tailscale : uvicorn remplace l'adresse du client par le premier saut de X-Forwarded-For quand la
    # connexion vient de 127.0.0.1 (--proxy-headers, activé par défaut). Une adresse d'un autre réseau (LAN, internet) n'est jamais acceptée.
    if peer is None or not (peer.is_loopback or _in_tailscale(peer)):
        return None
    if request.headers.get("host", "").rsplit(":", 1)[0].strip().lower().rstrip(".") != want_host:
        return None
    hop = forwarded_ip(request)
    if hop is None or not _in_tailscale(hop):
        return None
    login = request.headers.get("tailscale-user-login", "").strip().lower()
    if not login or "@" not in login:
        return None
    return login if ("*" in allowed or login in allowed) else None


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
