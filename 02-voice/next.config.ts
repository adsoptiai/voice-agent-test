/** @type {import('next').NextConfig} */

// 載入環境變數
require('dotenv').config();

const nextConfig = {
  experimental: {
    serverActions: true,
  },
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  },
};

module.exports = nextConfig;