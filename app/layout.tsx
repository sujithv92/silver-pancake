import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Router - Multi-Key Management & Proxy",
  description: "Intelligent AI API router with automatic key rotation, rate limit handling, and unified dashboard. Supports OpenAI, Anthropic, Groq, and more.",
  keywords: ["AI", "API", "Router", "OpenAI", "Anthropic", "Groq", "LLM", "Proxy", "Key Rotation"],
  authors: [{ name: "AI Router" }],
  openGraph: {
    title: "AI Router",
    description: "Manage multiple AI API keys with automatic rotation and rate limit handling",
    type: "website",
  }
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#fafafa]">{children}</body>
    </html>
  );
}
