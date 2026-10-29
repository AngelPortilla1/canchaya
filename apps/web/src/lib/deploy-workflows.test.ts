import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const stagingWorkflowPath = path.join(repoRoot, ".github/workflows/deploy-staging.yml");
const prodWorkflowPath = path.join(repoRoot, ".github/workflows/deploy-prod.yml");
const vercelConfigPath = path.join(repoRoot, "vercel.json");

describe("CI/CD deployment workflows (CY-015)", () => {
  it("defines deploy-staging.yml for pushes to develop targeting staging environment", () => {
    expect(existsSync(stagingWorkflowPath)).toBe(true);
    const content = readFileSync(stagingWorkflowPath, "utf8");

    expect(content).toContain("branches: [develop]");
    expect(content).toContain("cancel-in-progress: false");
    expect(content).toContain("name: staging");
    expect(content).toContain("supabase db push");
    expect(content).toContain("vercel pull --yes --environment=preview");
    expect(content).toContain("vercel deploy --prebuilt");

    const migrationIndex = content.indexOf("supabase db push");
    const deployIndex = content.indexOf("vercel deploy --prebuilt");
    expect(migrationIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(migrationIndex);
  });

  it("defines deploy-prod.yml for pushes to main and version tags targeting production environment", () => {
    expect(existsSync(prodWorkflowPath)).toBe(true);
    const content = readFileSync(prodWorkflowPath, "utf8");

    expect(content).toContain("branches: [main]");
    expect(content).toContain('tags: ["v*.*.*"]');
    expect(content).toContain("cancel-in-progress: false");
    expect(content).toContain("name: production");
    expect(content).toContain("supabase db push");
    expect(content).toContain("vercel pull --yes --environment=production");
    expect(content).toContain("vercel build --prod");
    expect(content).toContain("vercel deploy --prebuilt --prod");

    const migrationIndex = content.indexOf("supabase db push");
    const deployIndex = content.indexOf("vercel deploy --prebuilt --prod");
    expect(migrationIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(migrationIndex);
  });

  it("disables automatic Vercel git deployments in vercel.json to enforce migration-first deploys", () => {
    expect(existsSync(vercelConfigPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(vercelConfigPath, "utf8")) as {
      git?: { deploymentEnabled?: boolean };
    };
    expect(parsed.git?.deploymentEnabled).toBe(false);
  });
});

