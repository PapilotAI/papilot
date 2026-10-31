export interface LicenseNotice {
  name: string;
  version: string;
  license: string;
  url: string;
  notices: { name: string; text: string }[];
}

export interface AppInfo {
  version: string;
  repository: string;
  issues: string;
  license: string;
  licenseText: string;
}
