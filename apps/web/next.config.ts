import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The policy engine is shipped as TypeScript source from the workspace.
  transpilePackages: ["@udc/policy"],
};

export default nextConfig;
