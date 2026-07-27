import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scoubidou3D — See every strand",
  description: "A tactile concept redesign for Scoubidou3D, the browser-based 3D weaving studio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
