import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

/** Optional resource transport for clients that do not share the server origin. */
const Resources = createContext<{ resolve: (route: string) => Promise<string>; link: (route: string) => string } | null>(null);
export const ResourceProvider = Resources.Provider;
export function Resource({ route, children }: { route: string; children: (url: string | undefined) => ReactNode }) {
  const resolve = useContext(Resources)?.resolve;
  const [value, setValue] = useState<{ route: string; url: string }>();
  useEffect(() => {
    if (!resolve) return;
    let active = true;
    void resolve(route).then(url => { if (active) setValue({ route, url }); }).catch(error => console.error(error));
    return () => { active = false; };
  }, [resolve, route]);
  return children(resolve ? value?.route === route ? value.url : undefined : route);
}

export function ResourceLink({ route, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> & { route: string }) {
  const link = useContext(Resources)?.link;
  return <a {...props} href={link ? link(route) : route} target={link ? undefined : '_blank'} rel="noreferrer"/>;
}
