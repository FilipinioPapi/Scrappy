FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production DATA_DIR=/data PORT=8095 NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 8095
USER node
CMD ["node", "src/server.js"]
