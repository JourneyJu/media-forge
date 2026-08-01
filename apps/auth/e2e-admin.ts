import pg from "pg";
import { hashPassword } from "./src/password";

const pool = new pg.Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/mediaforge"
});
const hash = await hashPassword("TestAdmin1!");
await pool.query(
  `insert into users
    (id,account,username,username_normalized,display_name,role,status,
     password_hash,password_hash_algorithm,must_change_password)
   values ($1,$2,$2,lower($2),$3,'admin','active',$4,'argon2id',false)
   on conflict (id) do nothing`,
  ["user_codex_e2e", "codex_e2e_admin", "E2E 管理员", hash]
);
await pool.end();
