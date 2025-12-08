FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Expose WebSocket port
EXPOSE 3008

# Start the server
CMD ["node", "server.js"]
