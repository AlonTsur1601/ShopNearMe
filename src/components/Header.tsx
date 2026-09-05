import { Monitor, Moon, Sun } from "lucide-react";
import { useLayoutEffect, useState } from "react";
type Theme = "system" | "light" | "dark";
function savedTheme(): Theme { try { const value = localStorage.getItem("shopnearme:theme"); return value === "light" || value === "dark" ? value : "system"; } catch { return "system"; } }
export function Header({ onHome }: { onHome: () => void }) {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useLayoutEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? media?.matches ? "dark" : "light" : theme; };
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [theme]);
  const choose = (value: Theme) => { setTheme(value); try { localStorage.setItem("shopnearme:theme", value); } catch { /* appearance still works without storage */ } };
  return <header className="site-header"><button className="brand" type="button" onClick={onHome} aria-label="ShopNearMe home">ShopNearMe</button><div className="theme-switch" role="group" aria-label="Appearance">{([ ["system", Monitor, "System"], ["light", Sun, "Light"], ["dark", Moon, "Dark"] ] as const).map(([value, Icon, label]) => <button type="button" key={value} aria-label={`${label} theme`} aria-pressed={theme === value} title={`${label} theme`} onClick={() => choose(value)}><Icon size={17} /><span>{label}</span></button>)}</div></header>;
}
