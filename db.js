const mysql = require('mysql2');
const conf = require('./config');

async function getPool(){
  const pool  = await mysql.createPool({
        connectionLimit : 10,
        waitForConnections: true,
        queueLimit: 0,
        host     : conf.db_host,
        user     : conf.db_user,
        password : conf.db_password,
        database : conf.db_database,
        });
  const promisePool = pool.promise();
  return promisePool;
}

async function query(pool, querystring){
  const [rows,fields] = await pool.query(querystring);
  return rows;
}

async function end(pool){
    await pool.end(function (err) {
        // all connections in the pool have ended
      });
}

module.exports = { getPool, query, end };