declare module 'virtual:papilot-info' {
  const info: import('../license-info.ts').AppInfo;
  export default info;
}
declare module 'virtual:papilot-licenses' {
  const notices: import('../license-info.ts').LicenseNotice[];
  export default notices;
}
