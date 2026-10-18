export const isAdmin = (req, res, next) => {
  const { username, password } = req.headers;

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    return next();
  }

  return res.status(403).json({ success: false, message: "Admin access denied" });
};