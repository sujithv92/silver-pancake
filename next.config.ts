import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // For Vercel deployment
  experimental: {
    serverActions: {
      allowedOrigins: ["*"],
    },
  },
  // Allow CORS for API routes
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-AI-Provider, X-Provider, x-api-key, anthropic-version, openai-organization" },
        ],
      },
    ];
  },
};

export default nextConfig;
