FROM node:6

# Screwdriver Version
ARG VERSION=latest

# Create our application directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Install Screwdriver API
RUN npm install screwdriver-api@$VERSION
WORKDIR /usr/src/app/node_modules/screwdriver-api

# Setup configuration folder
RUN ln -s /config/local.yaml /usr/src/app/node_modules/screwdriver-api/config/local.yaml

# Expose the web service port
EXPOSE 8080

# Run the service
CMD [ "npm", "start" ]
