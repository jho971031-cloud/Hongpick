FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY *.cjs indicators.js package.json README.md ./
COPY docker-entrypoint.sh ./
RUN node test-state.cjs && node test-switching.cjs && node test-storage.cjs
ENV PAPER_DATA_DIR=/var/data
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["node", "bot.cjs"]
