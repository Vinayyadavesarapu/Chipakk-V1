const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

// MySQL Pool Configuration using environment variables ONLY
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'u781826529_chipakk',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000
};

// Create the connection pool
const pool = mysql.createPool(dbConfig);

/**
 * Test the database connection safely
 * @returns {Promise<{connected: boolean, message: string}>}
 */
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return {
      connected: true,
      message: 'Database connection successful',
      database: dbConfig.database
    };
  } catch (error) {
    console.error('[Database Pool Error] Connection test failed:', error.message);
    return {
      connected: false,
      message: 'Database connection failed',
      error: process.env.NODE_ENV === 'production' ? 'Connection refused' : error.message
    };
  }
};

module.exports = {
  pool,
  testConnection
};
