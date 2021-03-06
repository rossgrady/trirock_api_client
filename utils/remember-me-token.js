var rack = require('hat').rack();
const { URITooLong } = require('http-errors');
var db = require('../db');
const util = require('util');

module.exports = {
  consume: async function (token, done) {
    const dbpool = await db.getPool();
    const querystring1 = "SELECT * from tokens WHERE token = '" + token + "'";
    try {
      const rows1 = await db.query(dbpool, querystring1);
      if (rows1.length > 0) {
        const querystring2 = "SELECT * from users where id = '" + rows1[0].user + "'";
        try {
          const rows2 = await db.query(dbpool, querystring2);
          if (rows2.length > 0) {
            const querystring3 = "DELETE from tokens WHERE token = '" + token + "'";
            try {
              const rows3 = await db.query(dbpool, querystring3);
              return done(null, rows2[0]);
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

  create: async function (user, done) {
    const dbpool = await db.getPool();
    var token = rack();
    const querystring = "INSERT into tokens (token, user) VALUES ('" + token + "', '" + user.id + "')";
    try {
      const rows = await db.query(dbpool, querystring);
      return done(null, token);
    } catch (error) {
      console.error(error);
      return done(error);
    }
  },
  
  logout: async function (req, res, done) {
    const dbpool = await db.getPool();
    var token = req.cookies['remember_me'];
    if (!token) {
      return done();
    }
    const querystring = "DELETE from tokens WHERE token = '" + token + "'";
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