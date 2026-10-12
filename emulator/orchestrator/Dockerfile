# hasim-orchestrator: Node 22 + tsx. Contexto de construcción: la raíz del repositorio
# (comparte con la app la lógica pura de src/bridge y el exportador de packages).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./package.json
COPY emulator/package.json emulator/package-lock.json ./emulator/
RUN cd emulator && npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY data ./data
COPY emulator/orchestrator ./emulator/orchestrator
COPY emulator/scripts ./emulator/scripts
WORKDIR /app/emulator
ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "orchestrator/src/main.ts"]
