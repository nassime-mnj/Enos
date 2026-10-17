; E.N.O.S. + Dual Pulse Launcher — script Inno Setup 6. Appelé par build_release.py : /DAppVersion /DDistDir /DOutDir /DAssetsDir /DRootDir /DLauncherExe
; Compilation manuelle : ISCC.exe /DAppVersion=3.1.0 /DDistDir=... /DOutDir=... /DAssetsDir=... /DRootDir=... /DLauncherExe=...\DualPulseLauncher.exe enos.iss
;
; /DLauncherExe : chemin du Launcher Dual Pulse (Tauri) compilé par build_release.py. Quand il est fourni, l'installeur :
;   - copie le Launcher dans {autopf}\Dual Pulse Launcher (dossier protégé : pas modifiable par l'utilisateur) ;
;   - fait pointer les raccourcis (menu Démarrer, Bureau) et le lancement de fin d'installation vers le LAUNCHER, point d'entrée de l'écosystème ;
;   - ne remplace jamais le Launcher s'il tourne (c'est lui qui peut lancer cet installeur en mise à jour silencieuse).
; Sans /DLauncherExe (build de développement) : comportement historique, raccourcis vers ENOS.exe. build_release.py exige le Launcher sauf --skip-launcher.

#ifndef Edition
  #define Edition ""
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; GUID FIXE : c'est lui qui permet à une mise à jour de remplacer l'installation existante. NE JAMAIS LE CHANGER.
AppId={{6F1E2B7A-4C3D-4E8B-9A57-E905A1C0D3B2}
AppName=E.N.O.S. AI
AppVersion={#AppVersion}
AppVerName=E.N.O.S. AI {#AppVersion}
AppPublisher=E.N.O.S.
DefaultDirName={autopf}\ENOS
DefaultGroupName=E.N.O.S.
DisableProgramGroupPage=yes
; Droits administrateur (invite UAC) — l'installeur est élevé, pas l'application (elle tourne avec les droits normaux)
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutDir}
OutputBaseFilename=ENOS-Setup-{#AppVersion}{#Edition}
SetupIconFile={#DistDir}\logo.ico
UninstallDisplayIcon={app}\ENOS.exe
WizardStyle=modern
WizardImageFile={#AssetsDir}\wiz_large.bmp
WizardSmallImageFile={#AssetsDir}\wiz_small.bmp
Compression=lzma2/ultra64
SolidCompression=yes
; Ferme E.N.O.S. s'il tourne (mise à jour OTA) puis le relance via [Run]
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
MinVersion=10.0
; Plusieurs langues : la fenêtre de choix n'apparaît que si la langue de Windows n'est ni l'anglais ni le français
ShowLanguageDialog=auto

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[CustomMessages]
english.TaskDesktop=Create a desktop shortcut
french.TaskDesktop=Créer un raccourci sur le Bureau
english.GroupShortcuts=Shortcuts:
french.GroupShortcuts=Raccourcis :
english.TaskAutostart=Run E.N.O.S. in the background when Windows starts (calendar alerts even with the window closed)
french.TaskAutostart=Lancer E.N.O.S. en arrière-plan au démarrage de Windows (alertes de l'agenda même fenêtre fermée)
english.GroupStartup=Startup:
french.GroupStartup=Démarrage :
english.RunLauncher=Launch the Dual Pulse Launcher now
french.RunLauncher=Lancer le Dual Pulse Launcher maintenant
english.RunEnos=Launch E.N.O.S. now
french.RunEnos=Lancer E.N.O.S. maintenant
english.ShortcutBackground=E.N.O.S. (background)
french.ShortcutBackground=E.N.O.S. (arrière-plan)
english.WebView2Missing=The "Microsoft Edge WebView2 Runtime" component seems to be missing from this PC. E.N.O.S. and the Dual Pulse Launcher need it to display their interface.%n%nInstall it from: https://go.microsoft.com/fwlink/p/?LinkId=2124703
french.WebView2Missing=Le composant « Microsoft Edge WebView2 Runtime » semble absent de ce PC. E.N.O.S. et le Dual Pulse Launcher en ont besoin pour afficher leur interface.%n%nInstalle-le depuis : https://go.microsoft.com/fwlink/p/?LinkId=2124703

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; GroupDescription: "{cm:GroupShortcuts}"
Name: "autostart"; Description: "{cm:TaskAutostart}"; GroupDescription: "{cm:GroupStartup}"; Flags: unchecked

[Dirs]
; Les données (nasko_config.json, data\, historique) vivent À CÔTÉ de ENOS.exe : le dossier doit rester modifiable par l'utilisateur normal.
Name: "{app}"; Permissions: users-modify

[Files]
Source: "{#DistDir}\ENOS.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#DistDir}\logo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#DistDir}\godot_eye\*"; DestDir: "{app}\godot_eye"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#DistDir}\godot_chess\*"; DestDir: "{app}\godot_chess"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#DistDir}\godot_neon\*"; DestDir: "{app}\godot_neon"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
#ifdef LauncherExe
; Dual Pulse Launcher (Tauri) : dossier à part, protégé en écriture (contrairement à {app}, modifiable par l'utilisateur). Jamais remplacé s'il tourne (voir LauncherReplaceable).
Source: "{#LauncherExe}"; DestDir: "{autopf}\Dual Pulse Launcher"; DestName: "DualPulseLauncher.exe"; Flags: ignoreversion; Check: LauncherReplaceable
#endif
; Configuration vierge : posée UNE SEULE FOIS. Une mise à jour ne touche jamais aux réglages ni aux clés de l'utilisateur, et la désinstallation les conserve.
Source: "{#DistDir}\nasko_config.json"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#DistDir}\enos_profiles.json"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
#ifdef LauncherExe
; Le Launcher est le point d'entrée : c'est lui qui gère connexion, rôle, installation et mises à jour d'E.N.O.S.
Name: "{autoprograms}\Dual Pulse Launcher"; Filename: "{autopf}\Dual Pulse Launcher\DualPulseLauncher.exe"
Name: "{autodesktop}\Dual Pulse Launcher"; Filename: "{autopf}\Dual Pulse Launcher\DualPulseLauncher.exe"; Tasks: desktopicon
#else
Name: "{autoprograms}\E.N.O.S."; Filename: "{app}\ENOS.exe"; IconFilename: "{app}\logo.ico"
Name: "{autodesktop}\E.N.O.S."; Filename: "{app}\ENOS.exe"; IconFilename: "{app}\logo.ico"; Tasks: desktopicon
#endif
; Tâche de fond d'E.N.O.S. (alertes de l'agenda) : reste lancée directement, le Launcher n'a pas besoin d'être ouvert
Name: "{userstartup}\{cm:ShortcutBackground}"; Filename: "{app}\ENOS.exe"; Parameters: "--background"; Tasks: autostart

[Run]
; Installation normale : case de lancement en fin d'assistant (le Launcher si présent, sinon E.N.O.S.)
#ifdef LauncherExe
Filename: "{autopf}\Dual Pulse Launcher\DualPulseLauncher.exe"; Description: "{cm:RunLauncher}"; Flags: nowait postinstall skipifsilent runasoriginaluser
#else
Filename: "{app}\ENOS.exe"; Description: "{cm:RunEnos}"; Flags: nowait postinstall skipifsilent runasoriginaluser
#endif
; Mise à jour silencieuse (OTA) : relance automatique, avec les droits de l'utilisateur et non ceux de l'installeur
Filename: "{app}\ENOS.exe"; Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM ENOS.exe"; Flags: runhidden; RunOnceId: "KillEnos"
#ifdef LauncherExe
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM DualPulseLauncher.exe"; Flags: runhidden; RunOnceId: "KillLauncher"
#endif

[Code]
// E.N.O.S. et le Launcher affichent leur interface dans WebView2 (inclus dans Windows 11 ; parfois absent de Windows 10).
function WebView2Present: Boolean;
var v: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v)
         or RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v)
         or RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
  Result := Result and (v <> '') and (v <> '0.0.0.0');
end;

// Le Launcher peut lancer cet installeur lui-même (mise à jour silencieuse d'E.N.O.S.) : on ne remplace jamais son exécutable pendant qu'il tourne
// (fenêtre « Dual Pulse Launcher », visible ou cachée dans la zone de notification). Il sera mis à jour à la prochaine installation, Launcher fermé.
function LauncherReplaceable: Boolean;
begin
  Result := FindWindowByWindowName('Dual Pulse Launcher') = 0;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and (not WebView2Present) then
    MsgBox(CustomMessage('WebView2Missing'), mbInformation, MB_OK);
end;
