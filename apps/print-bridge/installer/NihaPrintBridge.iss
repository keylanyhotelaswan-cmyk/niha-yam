; NIHA Print Bridge — Inno Setup (no Admin)
; Default: %LocalAppData%\Programs\NIHA Print Bridge
; Data dir (%LocalAppData%\NihaPrintBridge) is never touched.

#define MyAppName "NIHA Print Bridge"
#define MyAppExeName "Niha.PrintBridge.exe"
#ifndef MyAppVersion
  #define MyAppVersion "0.5.3"
#endif
#ifndef MyPublishDir
  #define MyPublishDir "..\publish\win-x64"
#endif
#ifndef MyOutputDir
  #define MyOutputDir "..\..\..\public\downloads"
#endif

[Setup]
AppId={{8F3C2A91-6B4E-4D7A-9C1F-2E8B5D0A7F34}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=NIHA
AppPublisherURL=https://niha-yam.vercel.app
DefaultDirName={localappdata}\Programs\NIHA Print Bridge
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#MyOutputDir}
OutputBaseFilename=NihaPrintBridge-Setup
SetupIconFile=
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=force
RestartApplications=no
; Keep pairing / config across reinstall
UsePreviousAppDir=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a Desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce

[Files]
Source: "{#MyPublishDir}\Niha.PrintBridge.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyPublishDir}\bridge-defaults.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyPublishDir}\INSTALL.txt"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Do not delete %LocalAppData%\NihaPrintBridge — pairing survives reinstall.
Type: filesandordirs; Name: "{app}\updates"
