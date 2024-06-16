const qr = require("qr-image");
const {
  setupSession,
  deleteSession,
  reloadSession,
  validateSession,
  flushSessions,
  sessions,
} = require("../sessions");
const { sendErrorResponse, waitForNestedObject } = require("../utils");

/**
 * Starts a session for the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error starting the session.
 */
const startSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const setupSessionReturn = setupSession(sessionId);
    if (!setupSessionReturn.success) {
      return sendErrorResponse(res, 422, setupSessionReturn.message);
    }

    // wait until the client is created
    await waitForNestedObject(setupSessionReturn.client, "pupPage");
    return res.json({ success: true, message: setupSessionReturn.message });
  } catch (error) {
    console.log("startSession ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Status of the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error getting status of the session.
 */
const statusSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const sessionData = await validateSession(sessionId);
    return res.json(sessionData);
  } catch (error) {
    console.log("statusSession ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * QR code of the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error getting status of the session.
 */
const sessionQrCode = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const session = sessions.get(sessionId);
    if (!session) {
      return res.json({ success: false, message: "session_not_found" });
    }
    if (session.qr) {
      return res.json({ success: true, qr: session.qr });
    }
    return res.json({
      success: false,
      message: "qr code not ready or already scanned",
    });
  } catch (error) {
    console.log("sessionQrCode ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * QR code as image of the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to start.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error getting status of the session.
 */
const sessionQrCodeImage = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const session = sessions.get(sessionId);
    if (!session) {
      return res.json({ success: false, message: "session_not_found" });
    }
    if (session.qr) {
      const qrImage = qr.image(session.qr);
      res.writeHead(200, {
        "Content-Type": "image/png",
      });
      return qrImage.pipe(res);
    }
    return res.json({
      success: false,
      message: "qr code not ready or already scanned",
    });
  } catch (error) {
    console.log("sessionQrCodeImage ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Restarts the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to terminate.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the session.
 */
const restartSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const validation = await validateSession(sessionId);
    if (validation.message === "session_not_found") {
      return res.json(validation);
    }
    await reloadSession(sessionId);
    return res.json({ success: true, message: "Restarted successfully" });
  } catch (error) {
    console.log("restartSession ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Terminates the session with the given session ID.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @param {string} req.params.sessionId - The session ID to terminate.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the session.
 */
const terminateSession = async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const validation = await validateSession(sessionId);
    if (validation.message === "session_not_found") {
      return res.json(validation);
    }
    await deleteSession(sessionId, validation);
    return res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.log("terminateSession ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Terminates all inactive sessions.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the sessions.
 */
const terminateInactiveSessions = async (req, res) => {
  try {
    await flushSessions(true);
    return res.json({ success: true, message: "Flush completed successfully" });
  } catch (error) {
    console.log("terminateInactiveSessions ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

/**
 * Terminates all sessions.
 *
 * @function
 * @async
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @returns {Promise<void>}
 * @throws {Error} If there was an error terminating the sessions.
 */
const terminateAllSessions = async (req, res) => {
  try {
    await flushSessions(false);
    return res.json({ success: true, message: "Flush completed successfully" });
  } catch (error) {
    console.log("terminateAllSessions ERROR", error);
    return sendErrorResponse(res, 500, error.message);
  }
};

module.exports = {
  startSession,
  statusSession,
  sessionQrCode,
  sessionQrCodeImage,
  restartSession,
  terminateSession,
  terminateInactiveSessions,
  terminateAllSessions,
};
