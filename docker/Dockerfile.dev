FROM node:22.14.0

ARG UNAME=node
ARG UGROUP=node

RUN apt-get update && apt-get install -y jq && rm -rf /var/lib/apt/lists/*
RUN npm install -g typescript-language-server typescript

# playwright
RUN npm install -g @playwright/cli @playwright/test
RUN playwright-cli install-browser --with-deps chrome
RUN su -s /bin/bash "$UNAME" -c "playwright install ffmpeg"

# claude
RUN npm install -g @anthropic-ai/claude-code
RUN mkdir -p /home/$UNAME/.claude
RUN chown -R $UNAME:$UGROUP /home/$UNAME/.claude/

RUN corepack enable
