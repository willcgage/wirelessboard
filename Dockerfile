FROM node:20-bookworm-slim AS frontend
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN set -ux; \
    echo "Node:"; node --version; echo "npm:"; npm --version; \
    set +e; \
    npm run build; rc=$?; \
    set -e; \
    echo "npm run build exit code: $rc"; \
    echo "Listing static/ contents:"; ls -la static || true; \
    if [ -f npm-debug.log ]; then echo "npm-debug.log:"; sed -n '1,200p' npm-debug.log; fi; \
    exit $rc

FROM python:3.12-slim-bookworm AS runtime
LABEL author="Karl Swanson <karlcswanson@gmail.com>"
WORKDIR /usr/src/app

# Apply security updates and upgrade all packages
RUN apt-get update && \
	apt-get dist-upgrade -y --no-install-recommends && \
	apt-get autoremove -y && \
	rm -rf /var/lib/apt/lists/*

# Copy only what's needed at runtime
COPY py/ py/
COPY demo.html ./
COPY --from=frontend /usr/src/app/static/ static/
COPY democonfig.json package.json ./

RUN pip3 install --no-cache-dir -r py/requirements.txt

EXPOSE 8058
CMD ["python3", "py/wirelessboard.py"]
