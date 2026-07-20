# Build and deploy frontend (Next.js `output: 'standalone'`)
cd ./Frontend
yarn
# NEXT_PUBLIC_* is inlined into client JS at build time. Pin the prod API base
# here so it can't be overridden by .env.local (which points at localhost).
# The backend is proxied at kuma.day/api (nginx strips /api → :10010).
NEXT_PUBLIC_API_BASE=https://kuma.day/api yarn build
# Standalone output does NOT include static/ or public/ — fold them into the
# standalone tree so server.js can serve /_next/static and public assets
# (without this, every chunk 404s).
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
# Stamp the service worker with this build's id so every deploy ships a new
# sw.js → browsers auto-install it and reload clients onto the fresh assets.
BUILD_ID="$(cat .next/BUILD_ID)"
sed -i "s/__BUILD_ID__/${BUILD_ID}/g" .next/standalone/public/sw.js
# Ship the self-contained bundle to where pm2 runs standalone/server.js.
rsync -avzP --delete --exclude '.env.production' \
  ./.next/standalone/ jvck@192.168.0.3:/home/jvck/projects/bearry/frontend/standalone/
ssh jvck@192.168.0.3 ". ~/.bashrc; pm2 restart bearry-frontend"
cd ..

# Migrate DB
cd ./backend
yarn
yarn prisma migrate dev # Check for not applied local migrations first
export DATABASE_URL="postgresql://cat:123123senha@192.168.0.3:5432/bearry?schema=public"
yarn prisma migrate dev

# Build and deploy backend
yarn build
rsync -avzP ./dist/* jvck@192.168.0.3:/home/jvck/projects/bearry/backend
ssh jvck@192.168.0.3 "mkdir -p /home/jvck/projects/bearry/backend/prisma/prisma/client"
rsync -avzP --delete \
  --exclude 'libquery_engine-debian-*' \
  --exclude '*.wasm' \
  ./prisma/prisma/client/ \
  jvck@192.168.0.3:/home/jvck/projects/bearry/backend/prisma/prisma/client/

ssh jvck@192.168.0.3 ". ~/.bashrc; pm2 restart bearry-backend"
sleep 5
ssh jvck@192.168.0.3 ". ~/.bashrc; pm2 logs"