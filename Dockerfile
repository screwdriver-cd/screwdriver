FROM node:6

# Create our application directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Copy and install dependencies
COPY package.json /usr/src/app/
RUN npm install --production

# Copy everything else
COPY . /usr/src/app

# Setup configuration folder
RUN ln -s /usr/src/app/config /config

# Expose the web service port
EXPOSE 8080

# Run the service
CMD [ "npm", "start" ]
