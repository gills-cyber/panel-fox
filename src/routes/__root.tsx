import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "PanelFox";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "PanelFox — manga pages and clinic brochures. Drop photos, letter, and brand it.",
      },
      { name: "theme-color", content: "#ececee" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Comic+Neue:ital,wght@0,400;0,700;1,400;1,700&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,500&family=Gochi+Hand&family=Inter:ital,opsz,wght@0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&family=Karla:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=M+PLUS+Rounded+1c:wght@400;500;700;800&family=Mochiy+Pop+One&family=Nunito:ital,wght@0,600;0,700;0,800;1,600;1,700&family=Outfit:wght@400;600;700&family=Permanent+Marker&family=Playfair+Display:ital,wght@0,500;0,700;1,500&family=Quicksand:wght@500;600;700&family=Yomogi&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=JSON.parse(localStorage.getItem("koma-prefs-v1")||"{}");var lone=localStorage.getItem("koma-theme");var t=p.theme==="dark"||p.theme==="light"?p.theme:(lone==="dark"?"dark":"light");document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;if(t==="dark"){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#1c1c1e")}}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
