FROM node:20-slim

WORKDIR /app

# git is nodig omdat een van baileys' afhankelijkheden (libsignal) via een
# git-URL wordt geïnstalleerd in plaats van via het normale npm-registry.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm cache clean --force \
    && npm install --omit=dev --allow-git=all --no-audit --no-fund

COPY . .

# Data (WhatsApp-sessie + tijdelijke foto's) moet op een persistent volume staan
# (ingesteld als Railway Volume gemount op /app/data), anders moet je na elke
# herstart opnieuw de QR-code scannen. De Docker VOLUME-instructie wordt hier
# bewust niet gebruikt, want Railway's builder ondersteunt die niet.
EXPOSE 3000

CMD ["npm", "start"]
