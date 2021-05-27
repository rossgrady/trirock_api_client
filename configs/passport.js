var db = require('../db');
const bcrypt = require('bcrypt');
const saltRounds = 10;
var tokenStorage = require('../utils/remember-me-token');
var GoogleAuthenticator = require('passport-2fa-totp').GoogeAuthenticator;
var TwoFAStrategy = require('passport-2fa-totp').Strategy;
var RememberMeStrategy = require('passport-remember-me').Strategy;
const util = require('util');

module.exports = async function (passport) {
  const INVALID_LOGIN = 'Invalid username or password';
  const dbpool = await db.getPool();
  passport.serializeUser(function (user, done) {
    return done(null, user.id);    
  });
  passport.deserializeUser( async function (id, done) {
    const querystring = "SELECT * from users where id = " + id;
    console.log(querystring);
    try {
      const rows = await db.query(dbpool, querystring);
      if (rows.length > 0) {
        return done(null, rows[0])
      } else {
        return done(null, false);
      }
    } catch (error) {
      console.error(error);
      return done(error);
    }
  });
    
  passport.use('login', new TwoFAStrategy({
    usernameField: 'username',
    passwordField: 'password',
    codeField: 'code'
    }, function (username, password, done) {
      // 1st step verification: username and password
      process.nextTick( async function () {
        const querystring = "SELECT * from users where username = '" + username + "'";
        console.log(querystring);
        try {
          const rows = await db.query(dbpool, querystring);
          if (rows.length > 0) {
            const result = await bcrypt.compare(password, rows[0].password);
            if (result === true) {
              return done(null, rows[0]);
            } else {
              return done(null, false, { message: INVALID_LOGIN });
            }
          } else {
            return done(null, false, { message: INVALID_LOGIN });
          }
        } catch (error) {
          console.error(error);
          return done(error);
        }
      });
    }, function (user, done) {
      // 2nd step verification: TOTP code from Google Authenticator
      if (!user.secret) {
        done(new Error("Google Authenticator is not setup yet."));
      } else {
        // Google Authenticator uses 30 seconds key period
        // https://github.com/google/google-authenticator/wiki/Key-Uri-Format
        var secret = GoogleAuthenticator.decodeSecret(user.secret);
        done(null, secret, 30);
      }
  }));
    
  passport.use('register', new TwoFAStrategy({
    usernameField: 'username',
    passwordField: 'password',
    passReqToCallback: true,
    skipTotpVerification: true
    }, async function (req, username, password, done) {
      // 1st step verification: validate input and create new user
        
      if (!/^[A-Za-z0-9_]+$/g.test(req.body.username)) {
        return done(null, false, { message: 'Invalid username' });
      }
        
      if (req.body.password.length === 0) {
        return done(null, false, { message: 'Password is required' });
      }
        
      if (req.body.password !== req.body.confirmPassword) {
        return done(null, false, { message: 'Passwords do not match' });
      }
      console.log('normal checks passed');
      const querystring1 = "SELECT * from users where username = '" + username + "'";
      console.log(querystring1);
      try {
        const rows1 = await db.query(dbpool, querystring1);
        if (rows1.length > 0) {
          return done(null, false, { message: 'username taken' });
        } else {
          bcrypt.hash(password, saltRounds, async function (err, hash) {
            if (err) {
              return done(err);    
            }
            const querystring2 = "INSERT into users (username, password) VALUES ('" + username + "', '" + hash + "')";
            console.log(querystring2);
            const user = {
              username: username,
              password: hash,
            };
            try {
              const rows2 = await db.query(dbpool, querystring2);
              return done(null, user);
            } catch (error) {
              console.error(error);
              return done(error);
            }
          });
        }
      } catch (error) {
        console.error(error);
        return done(error);
      }
  }));

  passport.use(new RememberMeStrategy(function (token, done) {
    process.nextTick(function() {
      tokenStorage.consume(token, function (err, user) {
        if (err) {
          return done(err);
        } else if (user === false) {
          return done(null, false);
        } else {
          return done(null, user);
        }
      });
    });
  },
  function (user, done) {
    process.nextTick(function() {
      tokenStorage.create(user, done);
    });
  }));
};