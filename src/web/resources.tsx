import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Optional resource transport for clients that do not share the server origin. */
const Resources = createContext<((route: string) => Promise<string>) | null>(null);
export const ResourceProvider = Resources.Provider;
export function Resource({ route, children }: { route: string; children: (url: string | undefined) => ReactNode }) {
  const resolve = useContext(Resources);
  const [value, setValue] = useState<{ route: string; url: string }>();
  useEffect(() => {
    if (!resolve) return;
    let active = true;
    void resolve(route).then(url => { if (active) setValue({ route, url }); }).catch(error => console.error(error));
    return () => { active = false; };
  }, [resolve, route]);
  return children(resolve ? value?.route === route ? value.url : undefined : route);
}
