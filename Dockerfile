FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Data (WhatsApp-sessie + tijdelijke foto's) moet op een persistent volume staan,
# anders moet je na elke herstart opnieuw de QR-code scannen.
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["npm", "start"]
