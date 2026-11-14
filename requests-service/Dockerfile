FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY --chmod=755 entrypoint.sh /entrypoint.sh
ENV NODE_ENV=production DATA_DIR=/data PORT=8095 NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 8095
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/server.js"]
