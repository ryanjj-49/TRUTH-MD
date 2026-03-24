FROM node:20

  RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg imagemagick webp git python3 make g++ procps && apt-get clean && rm -rf /var/lib/apt/lists/*

  WORKDIR /app

  COPY package*.json ./

  RUN npm install --legacy-peer-deps --ignore-scripts
  RUN node scripts/patch-baileys.cjs || true
  RUN rm -rf node_modules/sharp && npm install --platform=linux --arch=x64 sharp@0.32.6 --legacy-peer-deps

  COPY . .

  EXPOSE 3000 5000
  ENV NODE_ENV=production
  CMD ["node", "index.js"]
  