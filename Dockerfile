# One image for every Steward process: the assistant (steward), its sub-agents and A2A
# proxies (steward agent / a2a-proxy), the built-in MCP servers (steward-mcp), and Warden's
# gateway and token service, built from the pinned Warden commit.

FROM node:24-bookworm-slim AS ui
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

FROM rust:1-bookworm AS build
WORKDIR /src
# Warden at the commit Steward is pinned to (see Cargo.toml).
ARG WARDEN_REV=ceb31d9e3627f90125b383a788c8ea05f6cde766
RUN cargo install --locked --git https://github.com/byQuexo/warden --rev ${WARDEN_REV} warden-cli warden-gateway --root /out
COPY . .
RUN cargo build --release --locked -p steward -p steward-mcp-servers \
 && cp target/release/steward target/release/steward-mcp /out/bin/

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /var/lib/warden /var/lib/sts \
 && chown 65532:65532 /data /var/lib/warden /var/lib/sts
COPY --from=build /out/bin/ /usr/local/bin/
COPY --from=ui /ui/dist /app/ui
COPY profiles /profiles
USER 65532:65532
EXPOSE 8000
ENTRYPOINT ["steward"]
CMD ["serve", "--config", "/etc/steward/steward.yaml"]
