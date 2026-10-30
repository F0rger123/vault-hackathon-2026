; Inno Setup recipe for VAULT (F12.12). Run through packaging/build_windows.ps1, which passes AppVersion.
; Per-user: no administrator rights. Program files go to %LOCALAPPDATA%\Programs\VAULT. The user's documents and
; database live in %LOCALAPPDATA%\VAULT, which this installer never lists, so uninstalling leaves them in place.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6F4C8B52-3E0A-4D57-9A61-2C7B1E94D0A3}
AppName=VAULT
AppVersion={#AppVersion}
AppPublisher=Luke Knight
DefaultDirName={localappdata}\Programs\VAULT
DefaultGroupName=VAULT
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=VAULT-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\VAULT.exe
UninstallDisplayName=VAULT
CloseApplications=yes
LicenseFile=..\LICENSE

[Files]
Source: "..\dist\VAULT\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\VAULT"; Filename: "{app}\VAULT.exe"
Name: "{group}\Uninstall VAULT"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\VAULT.exe"; Description: "Open VAULT"; Flags: nowait postinstall skipifsilent

[Messages]
FinishedLabel=VAULT is installed. Uninstalling removes the program and keeps your data in your app-data folder (VAULT).
