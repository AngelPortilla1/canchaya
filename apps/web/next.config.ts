import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

for (const envFile of [".env.local", ".env"]) {
  const rootEnvPath = path.resolve(import.meta.dirname, "../../", envFile);
  if (existsSync(rootEnvPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(rootEnvPath);
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ["@canchaya/core"],
};

export default nextConfig;
