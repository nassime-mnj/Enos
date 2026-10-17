"""Diagnostic « mon PC peut-il etre allume a distance ? » (lecture seule : ne modifie RIEN).

    py diagnostic_reveil.py

Verifie : type de PC, carte reseau utilisee (filaire/Wi-Fi), Wake-on-LAN de la carte et dans Windows, demarrage rapide,
etats de veille, ouverture de session automatique, demarrage automatique de E.N.O.S. Conclut et dit quoi corriger.
"""
import json
import os
import subprocess
import sys

OK, KO, WARN = "[ OK ]", "[ KO ]", "[ !! ]"
PS = r"""
$r = [ordered]@{}
$cs = Get-CimInstance Win32_ComputerSystem; $r.model = "$($cs.Manufacturer) $($cs.Model)"; $r.laptop = ($cs.PCSystemType -eq 2)
$def = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
$ad = Get-NetAdapter -InterfaceIndex $def.InterfaceIndex; $r.active = "$($ad.Name) | $($ad.InterfaceDescription)"; $r.active_wired = ("$($ad.PhysicalMediaType)" -match '802.3'); $r.active_mac = $ad.MacAddress
$wired = Get-NetAdapter -Physical | Where-Object { "$($_.PhysicalMediaType)" -match '802.3' } | Select-Object -First 1
$r.has_wired = [bool]$wired
if ($wired) {
  $r.wired = "$($wired.Name) | $($wired.InterfaceDescription) | $($wired.Status) | $($wired.MacAddress)"
  $r.wired_up = ($wired.Status -eq 'Up')
  $adv = Get-NetAdapterAdvancedProperty -Name $wired.Name -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Wake|Magic|WoL|R.veil' }
  $r.wired_wol_props = @($adv | ForEach-Object { "$($_.DisplayName) = $($_.DisplayValue)" })
  $r.wired_wol_programmable = [bool]((powercfg /devicequery wake_programmable) -match [regex]::Escape($wired.InterfaceDescription))
  $r.wired_wol_armed = [bool]((powercfg /devicequery wake_armed) -match [regex]::Escape($wired.InterfaceDescription))
}
$wifi = Get-NetAdapter -Physical | Where-Object { "$($_.PhysicalMediaType)" -match '802.11' } | Select-Object -First 1
if ($wifi) { $r.wifi_programmable = [bool]((powercfg /devicequery wake_programmable) -match [regex]::Escape($wifi.InterfaceDescription)) }
try { $r.fast_startup = [int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled).HiberbootEnabled } catch { $r.fast_startup = $null }
$a = (powercfg /a) -join "`n"; $r.s3 = ($a -match 'S3');
try { $r.autologon = "$((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').AutoAdminLogon)" } catch { $r.autologon = "" }
$su = [Environment]::GetFolderPath('Startup'); $r.autostart = [bool](Get-ChildItem $su -Filter '*E.N.O.S.*.lnk' -ErrorAction SilentlyContinue)
$r | ConvertTo-Json -Compress -Depth 4
"""


def line(state, text):
    print(f"{state} {text}")


def main():
    out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", PS], capture_output=True, text=True, encoding="utf-8", timeout=60).stdout.strip()
    try:
        r = json.loads(out)
    except ValueError:
        sys.exit("Diagnostic impossible (PowerShell n'a rien renvoye).")
    cfg = {}
    try:
        from nasko_core import load_config
        cfg = load_config()
    except Exception:
        pass
    print(f"PC : {r['model']} ({'portable' if r['laptop'] else 'fixe'})\nCarte utilisee pour Internet : {r['active']} | MAC {r['active_mac']}\n")
    blockers, tips = 0, []

    if r["active_wired"]:
        line(OK, "Le PC est relié en Ethernet.")
    else:
        line(KO, "Le PC est en Wi-Fi : le réveil par le réseau (WoL) ne fonctionne en pratique QU'EN ETHERNET.")
        blockers += 1
        tips.append("Branchez un câble Ethernet (ou une station d'accueil / adaptateur USB-Ethernet compatible WoL) ; le relais visera cette carte.")
    if r.get("has_wired"):
        line(OK if r.get("wired_up") else WARN, f"Carte Ethernet : {r['wired']}" + ("" if r.get("wired_up") else "  → câble débranché"))
        props = r.get("wired_wol_props") or []
        for p in props:
            line(OK if ("Activé" in p or "Enabled" in p) and "S0ix" not in p else WARN, "  option carte : " + p)
        if r.get("wired_wol_programmable"):
            line(OK, "Windows reconnaît cette carte comme capable de réveiller le PC.")
        else:
            line(KO, "Windows ne la déclare pas capable de réveiller le PC.")
            blockers += 1
        if r.get("wired_wol_programmable") and not r.get("wired_wol_armed"):
            line(WARN, "Réveil par cette carte non armé : Gestionnaire de périphériques > carte > Gestion de l'alimentation > cocher « Autoriser ce périphérique à réveiller l'ordinateur » et « Autoriser uniquement un paquet magique ».")
            tips.append("Armez le réveil de la carte Ethernet dans Gestionnaire de périphériques > Gestion de l'alimentation.")
    else:
        line(KO, "Aucune carte Ethernet sur ce PC.")
        blockers += 1
    if r.get("wifi_programmable") is False:
        line(WARN, "La carte Wi-Fi n'est pas déclarée capable de réveiller le PC par Windows (donc pas de réveil par Wi-Fi).")
    if r.get("fast_startup") == 1:
        line(WARN, "Démarrage rapide ACTIF : un arrêt « complet » est en fait une hibernation, ce qui empêche souvent le WoL.")
        tips.append("Désactivez le démarrage rapide : Options d'alimentation > Choisir l'action des boutons d'alimentation > décocher « Activer le démarrage rapide ».")
    elif r.get("fast_startup") == 0:
        line(OK, "Démarrage rapide désactivé.")
    line(OK if r.get("s3") else WARN, "Veille classique (S3) disponible." if r.get("s3") else "Veille classique (S3) non disponible (Modern Standby) : réveil réseau moins fiable.")
    if not r.get("autologon") or r.get("autologon") == "0":
        line(WARN, "Pas d'ouverture de session automatique : après un réveil depuis l'ARRÊT, Windows attend le mot de passe et E.N.O.S. ne démarre pas. (Après un réveil depuis la VEILLE, la session reste ouverte : tout reprend.)")
        tips.append("Pour un réveil depuis l'arrêt : activez l'ouverture de session automatique (netplwiz) — à peser : n'importe qui allumant le PC accède à votre session. Préférez la VEILLE.")
    line(OK if r.get("autostart") else WARN, "E.N.O.S. démarre avec Windows." if r.get("autostart") else "E.N.O.S. ne démarre pas tout seul : py creer_raccourci.py --demarrage")
    if not r.get("autostart"):
        tips.append("Démarrage automatique de E.N.O.S. : py creer_raccourci.py --demarrage")
    line(OK if cfg.get("keep_awake") else WARN, "« PC éveillé » activé dans E.N.O.S." if cfg.get("keep_awake") else "« PC éveillé » désactivé : le PC se met en veille et E.N.O.S. devient injoignable.")

    print("\n=== VERDICT ===")
    if blockers:
        print("Allumage à distance : PEU PROBABLE avec la configuration actuelle.")
        print("Solution fiable SANS réveil réseau : laisser le PC allumé et chez vous (« PC éveillé » dans le panneau ACCÈS TÉLÉPHONE, secteur branché,")
        print("fermeture du capot = ne rien faire), et y accéder de l'extérieur via un VPN (Tailscale).")
    else:
        print("Allumage à distance : POSSIBLE. Testez : mettez le PC en veille, puis envoyez un réveil depuis le relais.")
    for t in tips:
        print(" -", t)


if __name__ == "__main__":
    main()
