FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000

# migrate -> seed admins from ADMIN_PHONES -> start API. Seeding is idempotent
# and guarantees an admin exists on a fresh deploy (roles are otherwise only
# assigned lazily at first login).
CMD ["sh", "-c", "node src/migrate.js && node src/seedAdmins.js && node src/index.js"]
