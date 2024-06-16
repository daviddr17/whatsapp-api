const { Client, LocalAuth } = require("whatsapp-web.js");
const fs = require("fs");
const path = require("path");
const sessions = new Map();
const {
  baseWebhookURL,
  sessionFolderPath,
  maxAttachmentSize,
  setMessagesAsSeen,
  webVersion,
  webVersionCacheType,
  recoverSessions,
} = require("./config");
const {
  triggerWebhook,
  waitForNestedObject,
  checkIfEventisEnabled,
} = require("./utils");


// Function to validate if the session is ready
const validateSession = async (sessionId) => {
  try {
    const returnData = { success: false, state: null, message: "" };

    if (!sessions.has(sessionId) || !sessions.get(sessionId)) {
      returnData.message = "session_not_found";
      return returnData;
    }

    const client = sessions.get(sessionId);

    // Validate session state
    let maxRetry = 0;
    while (true) {
      try {
        if (client.pupPage.isClosed()) {
          return { success: false, state: null, message: "browser tab closed" };
        }
        await Promise.race([
          client.pupPage.evaluate("1"),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
        break;
      } catch (error) {
        if (maxRetry === 2) {
          return { success: false, state: null, message: "session closed" };
        }
        maxRetry++;
      }
    }

    const state = await client.getState();
    returnData.state = state;
    if (state !== "CONNECTED") {
      returnData.message = "session_not_connected";
      return returnData;
    }

    returnData.success = true;
    returnData.message = "session_connected";
    return returnData;
  } catch (error) {
    console.log(error);
    return { success: false, state: null, message: error.message };
  }
};

// Function to handle client session restoration
const restoreSessions = () => {
  try {
    if (!fs.existsSync(sessionFolderPath)) {
      fs.mkdirSync(sessionFolderPath); // Create the session directory if it doesn't exist
    }
    // Read the contents of the folder
    fs.readdir(sessionFolderPath, (_, files) => {
      // Iterate through the files in the parent folder
      for (const file of files) {
        // Use regular expression to extract the string from the folder name
        const match = file.match(/^session-(.+)$/);
        if (match) {
          const sessionId = match[1];
          console.log("existing session detected", sessionId);
          setupSession(sessionId);
        }
      }
    });
  } catch (error) {
    console.log(error);
    console.error("Failed to restore sessions:", error);
  }
};

// Setup Session
const setupSession = (sessionId) => {
  try {
    if (sessions.has(sessionId)) {
      return {
        success: false,
        message: `Session already exists for: ${sessionId}`,
        client: sessions.get(sessionId),
      };
    }

    // Disable the delete folder from the logout function (will be handled separately)
    const localAuth = new LocalAuth({
      clientId: sessionId,
      dataPath: sessionFolderPath,
    });
    delete localAuth.logout;
    localAuth.logout = () => {};

    const clientOptions = {
      puppeteer: {
        executablePath: process.env.CHROME_BIN || null,
        // headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
        ],
      },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
      authStrategy: localAuth,
    };

    if (webVersion) {
      clientOptions.webVersion = webVersion;
      switch (webVersionCacheType.toLowerCase()) {
        case "local":
          clientOptions.webVersionCache = {
            type: "local",
          };
          break;
        case "remote":
          clientOptions.webVersionCache = {
            type: "remote",
            remotePath:
              "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/" +
              webVersion +
              ".html",
          };
          break;
        default:
          clientOptions.webVersionCache = {
            type: "none",
          };
      }
    }

    const client = new Client(clientOptions);

    client
      .initialize()
      .catch((err) => console.log("Initialize error:", err.message));

    initializeEvents(client, sessionId);

    // Save the session to the Map
    sessions.set(sessionId, client);
    return { success: true, message: "Session initiated successfully", client };
  } catch (error) {
    return { success: false, message: error.message, client: null };
  }
};

const initializeEvents = async (client, sessionId) => {
  // Check if the session webhook is overridden
  const sessionWebhook =
    process.env[sessionId.toUpperCase() + "_WEBHOOK_URL"] || baseWebhookURL;

  if (recoverSessions) {
    try {
      await waitForNestedObject(client, "pupPage");

      const restartSession = async (sessionId) => {
        sessions.delete(sessionId);
        await client
          .destroy()
          .catch((e) => console.error("Error destroying client:", e));
        setupSession(sessionId);
      };

      client.pupPage.once("close", () => {
        console.log(`Browser page closed for ${sessionId}. Restoring`);
        restartSession(sessionId);
      });

      client.pupPage.once("error", () => {
        console.log(
          `Error occurred on browser page for ${sessionId}. Restoring`
        );
        restartSession(sessionId);
      });
    } catch (e) {
      console.error("Error waiting for nested object:", e.message);
    }
  }

  const events = [
    {
      name: "auth_failure",
      handler: (msg) =>
        triggerWebhook(sessionWebhook, sessionId, "status", { msg }),
    },
    {
      name: "authenticated",
      handler: () => triggerWebhook(sessionWebhook, sessionId, "authenticated"),
    },
    {
      name: "call",
      handler: async (call) =>
        triggerWebhook(sessionWebhook, sessionId, "call", { call }),
    },
    {
      name: "change_state",
      handler: (state) =>
        triggerWebhook(sessionWebhook, sessionId, "change_state", { state }),
    },
    {
      name: "disconnected",
      handler: (reason) =>
        triggerWebhook(sessionWebhook, sessionId, "disconnected", { reason }),
    },
    {
      name: "group_join",
      handler: (notification) =>
        triggerWebhook(sessionWebhook, sessionId, "group_join", {
          notification,
        }),
    },
    {
      name: "group_leave",
      handler: (notification) =>
        triggerWebhook(sessionWebhook, sessionId, "group_leave", {
          notification,
        }),
    },
    {
      name: "group_update",
      handler: (notification) =>
        triggerWebhook(sessionWebhook, sessionId, "group_update", {
          notification,
        }),
    },
    {
      name: "loading_screen",
      handler: (percent, message) =>
        triggerWebhook(sessionWebhook, sessionId, "loading_screen", {
          percent,
          message,
        }),
    },
    {
      name: "media_uploaded",
      handler: (message) =>
        triggerWebhook(sessionWebhook, sessionId, "media_uploaded", {
          message,
        }),
    },
    {
      name: "message",
      handler: async (message) => {
        triggerWebhook(sessionWebhook, sessionId, "message", { message });
        if (message.hasMedia && message._data?.size < maxAttachmentSize) {
          try {
            const messageMedia = await message.downloadMedia();
            triggerWebhook(sessionWebhook, sessionId, "media", {
              messageMedia,
              message,
            });
          } catch (e) {
            console.error("Download media error:", e.message);
          }
        }
        if (setMessagesAsSeen) {
          const chat = await message.getChat();
          await chat.sendSeen();
        }
      },
    },
    {
      name: "message_ack",
      handler: async (message, ack) => {
        triggerWebhook(sessionWebhook, sessionId, "message_ack", {
          message,
          ack,
        });
        if (setMessagesAsSeen) {
          const chat = await message.getChat();
          await chat.sendSeen();
        }
      },
    },
    {
      name: "message_create",
      handler: async (message) => {
        triggerWebhook(sessionWebhook, sessionId, "message_create", {
          message,
        });
        if (setMessagesAsSeen) {
          const chat = await message.getChat();
          await chat.sendSeen();
        }
      },
    },
    {
      name: "message_reaction",
      handler: (reaction) =>
        triggerWebhook(sessionWebhook, sessionId, "message_reaction", {
          reaction,
        }),
    },
    {
      name: "message_edit",
      handler: (message, newBody, prevBody) =>
        triggerWebhook(sessionWebhook, sessionId, "message_edit", {
          message,
          newBody,
          prevBody,
        }),
    },
    {
      name: "message_ciphertext",
      handler: (message) =>
        triggerWebhook(sessionWebhook, sessionId, "message_ciphertext", {
          message,
        }),
    },
    {
      name: "message_revoke_everyone",
      handler: async (message) =>
        triggerWebhook(sessionWebhook, sessionId, "message_revoke_everyone", {
          message,
        }),
    },
    {
      name: "message_revoke_me",
      handler: async (message) =>
        triggerWebhook(sessionWebhook, sessionId, "message_revoke_me", {
          message,
        }),
    },
    {
      name: "qr",
      handler: (qr) => {
        client.qr = qr;
        triggerWebhook(sessionWebhook, sessionId, "qr", { qr });
      },
    },
    {
      name: "ready",
      handler: () => triggerWebhook(sessionWebhook, sessionId, "ready"),
    },
    {
      name: "contact_changed",
      handler: async (message, oldId, newId, isContact) =>
        triggerWebhook(sessionWebhook, sessionId, "contact_changed", {
          message,
          oldId,
          newId,
          isContact,
        }),
    },
    {
      name: "chat_removed",
      handler: async (chat) =>
        triggerWebhook(sessionWebhook, sessionId, "chat_removed", { chat }),
    },
    {
      name: "chat_archived",
      handler: async (chat, currState, prevState) =>
        triggerWebhook(sessionWebhook, sessionId, "chat_archived", {
          chat,
          currState,
          prevState,
        }),
    },
    {
      name: "unread_count",
      handler: async (chat) =>
        triggerWebhook(sessionWebhook, sessionId, "unread_count", { chat }),
    },
  ];

  for (const event of events) {
    if (await checkIfEventisEnabled(event.name)) {
      client.on(event.name, event.handler);
    }
  }
};

// Function to delete client session folder
const deleteSessionFolder = async (sessionId) => {
  try {
    const targetDirPath = path.join(sessionFolderPath, `session-${sessionId}`);
    const resolvedTargetDirPath = await fs.promises.realpath(targetDirPath);
    const resolvedSessionPath = await fs.promises.realpath(sessionFolderPath);

    // Ensure the target directory path ends with a path separator
    const safeSessionPath = `${resolvedSessionPath}${path.sep}`;

    // Validate the resolved target directory path is a subdirectory of the session folder path
    if (!resolvedTargetDirPath.startsWith(safeSessionPath)) {
      throw new Error("Invalid path: Directory traversal detected");
    }
    await fs.promises.rm(resolvedTargetDirPath, {
      recursive: true,
      force: true,
    });
  } catch (error) {
    console.log("Folder deletion error", error);
    throw error;
  }
};

// Function to reload client session without removing browser cache
const reloadSession = async (sessionId) => {
  try {
    const client = sessions.get(sessionId);
    if (!client) {
      return;
    }
    client.pupPage.removeAllListeners("close");
    client.pupPage.removeAllListeners("error");
    try {
      const pages = await client.pupBrowser.pages();
      await Promise.all(pages.map((page) => page.close()));
      await Promise.race([
        client.pupBrowser.close(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch (e) {
      const childProcess = client.pupBrowser.process();
      if (childProcess) {
        childProcess.kill(9);
      }
    }
    sessions.delete(sessionId);
    setupSession(sessionId);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

const deleteSession = async (sessionId, validation) => {
  try {
    const client = sessions.get(sessionId);
    if (!client) {
      return;
    }
    client.pupPage.removeAllListeners("close");
    client.pupPage.removeAllListeners("error");
    if (validation.success) {
      // Client Connected, request logout
      console.log(`Logging out session ${sessionId}`);
      await client.logout();
    } else if (validation.message === "session_not_connected") {
      // Client not Connected, request destroy
      console.log(`Destroying session ${sessionId}`);
      await client.destroy();
    }
    // Wait 10 secs for client.pupBrowser to be disconnected before deleting the folder
    let maxDelay = 0;
    while (client.pupBrowser.isConnected() && maxDelay < 10) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      maxDelay++;
    }
    await deleteSessionFolder(sessionId);
    sessions.delete(sessionId);
  } catch (error) {
    console.log(error);
    throw error;
  }
};

// Function to handle session flush
const flushSessions = async (deleteOnlyInactive) => {
  try {
    // Read the contents of the sessions folder
    const files = await fs.promises.readdir(sessionFolderPath);
    // Iterate through the files in the parent folder
    for (const file of files) {
      // Use regular expression to extract the string from the folder name
      const match = file.match(/^session-(.+)$/);
      if (match) {
        const sessionId = match[1];
        const validation = await validateSession(sessionId);
        if (!deleteOnlyInactive || !validation.success) {
          await deleteSession(sessionId, validation);
        }
      }
    }
  } catch (error) {
    console.log(error);
    throw error;
  }
};

module.exports = {
  sessions,
  setupSession,
  restoreSessions,
  validateSession,
  deleteSession,
  reloadSession,
  flushSessions,
};
