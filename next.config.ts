import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.BUILD_TARGET === 'docker' ? { output: 'export' } : {};

export default nextConfig;
