FROM node:18

# Screwdriver Version
ARG VERSION=latest

# Create our application directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# update npm
RUN npm install -g npm
RUN npm cache clean -f

# Install Screwdriver API
RUN npm install --fetch-timeout=1200000 screwdriver-api@$VERSION
WORKDIR /usr/src/app/node_modules/screwdriver-api

# Setup configuration folder
RUN ln -s /usr/src/app/node_modules/screwdriver-api/config /config

# Expose the web service port
EXPOSE 8080

# Run the service
CMD [ "npm", "start" ]
