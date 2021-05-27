var rack = require('hat').rack();
var db = require('../db');
const dbpool = db.getPool();

module.exports = {
  consume: function (token, done) {
    const querystring1 = "SELECT * from tokens WHERE token = " + token;
    try {
      const rows1 = await db.query(dbpool, querystring1);
      if (typeof rows1 !== 'undefined') {
        const querystring2 = "SELECT * from users where id = " + rows1[0].user;
        try {
          const rows2 = await db.query(dbpool, querystring2);
          if (typeof rows2 !== 'undefined') {
            const querystring3 = "DELETE from tokens WHERE token = " + token;
            try {
              const rows3 = await db.query(dbpool, querystring3);
              return done(null, rows2[0].id);
            } catch (error) {
              console.error(error);
              return done(error);
            }
          } else {
            return done(null, false)
          }
        } catch (error) {
          console.error(error);
          return done(error);
        }
      } else {
        return done(null, false);
      }
    } catch (error) {
      console.error(error);
      return done(error);
    }
  },

  create: function (user, done) {
    var token = rack();
    const querystring = "INSERT into tokens (token, user) VALUES (" + token + "," + user.id + ")";
    try {
      const rows = await db.query(dbpool, querystring);
      return done(null, token);
    } catch (error) {
      console.error(error);
      return done(error);
    }
  },
  
  logout: function (req, res, done) {
    var token = req.cookies['remember_me'];
    if (!token) {
      return done();
    }
    const querystring = "DELETE from tokens WHERE token = " + token;
    try {
      const rows = await db.query(dbpool, querystring);
      res.clearCookie('remember_me');
      return done();
    } catch (error) {
      console.error(error);
      return done(error);
    }
  }
};