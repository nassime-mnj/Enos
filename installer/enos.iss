; E.N.O.S. — script Inno Setup 6. Appelé par build_release.py : /DAppVersion /DDistDir /DOutDir /DAssetsDir /DRootDir
; Compilation manuelle : ISCC.exe /DAppVersion=3.1.0 /DDistDir=... /DOutDir=... /DAssetsDir=... /DRootDir=... enos.iss

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

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"
Name: "autostart"; Description: "Lancer E.N.O.S. en arrière-plan au démarrage de Windows (alertes de l'agenda même fenêtre fermée)"; GroupDescription: "Démarrage :"; Flags: unchecked

[Dirs]
; Les données (nasko_config.json, data\, historique) vivent À CÔTÉ de ENOS.exe : le dossier doit rester modifiable par l'utilisateur normal.
Name: "{app}"; Permissions: users-modify

[Files]
Source: "{#DistDir}\ENOS.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#DistDir}\logo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#DistDir}\godot_eye\*"; DestDir: "{app}\godot_eye"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#DistDir}\godot_chess\*"; DestDir: "{app}\godot_chess"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#DistDir}\godot_neon\*"; DestDir: "{app}\godot_neon"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
; Configuration vierge : posée UNE SEULE FOIS. Une mise à jour ne touche jamais aux réglages ni aux clés de l'utilisateur, et la désinstallation les conserve.
Source: "{#DistDir}\nasko_config.json"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#DistDir}\enos_profiles.json"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{autoprograms}\E.N.O.S."; Filename: "{app}\ENOS.exe"; IconFilename: "{app}\logo.ico"
Name: "{autodesktop}\E.N.O.S."; Filename: "{app}\ENOS.exe"; IconFilename: "{app}\logo.ico"; Tasks: desktopicon
Name: "{userstartup}\E.N.O.S. (arrière-plan)"; Filename: "{app}\ENOS.exe"; Parameters: "--background"; Tasks: autostart

[Run]
; Installation normale : case « Lancer E.N.O.S. » en fin d'assistant
Filename: "{app}\ENOS.exe"; Description: "Lancer E.N.O.S. maintenant"; Flags: nowait postinstall skipifsilent runasoriginaluser
; Mise à jour silencieuse (OTA) : relance automatique, avec les droits de l'utilisateur et non ceux de l'installeur
Filename: "{app}\ENOS.exe"; Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM ENOS.exe"; Flags: runhidden; RunOnceId: "KillEnos"

[Code]
// E.N.O.S. affiche son interface dans WebView2 (inclus dans Windows 11 ; parfois absent de Windows 10).
function WebView2Present: Boolean;
var v: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v)
         or RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v)
         or RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v);
  Result := Result and (v <> '') and (v <> '0.0.0.0');
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and (not WebView2Present) then
    MsgBox('Le composant « Microsoft Edge WebView2 Runtime » semble absent de ce PC. E.N.O.S. en a besoin pour afficher son interface.' + #13#10#13#10 +
           'Installe-le depuis : https://go.microsoft.com/fwlink/p/?LinkId=2124703', mbInformation, MB_OK);
end;
