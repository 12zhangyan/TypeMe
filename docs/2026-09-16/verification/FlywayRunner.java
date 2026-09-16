import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.output.MigrateResult;

/**
 * 最小 Flyway 执行器：把 backend/src/main/resources/db/migration 下的真实脚本
 * 在真实 MySQL 8.4 上跑一遍。只连一个库（由 url 决定），不做任何跨库操作。
 */
public class FlywayRunner {
    public static void main(String[] args) throws Exception {
        String url = args[0];
        String user = args[1];
        String pass = args[2];
        String locations = args[3];

        System.out.println("[runner] url       = " + url);
        System.out.println("[runner] locations = " + locations);
        System.out.println("[runner] flyway    = " + Flyway.class.getPackage().getImplementationVersion());

        Flyway flyway = Flyway.configure()
                .dataSource(url, user, pass)
                .locations(locations)
                .baselineOnMigrate(false)
                .validateOnMigrate(true)
                .cleanDisabled(true)
                .group(false)
                .load();

        MigrateResult result = flyway.migrate();
        System.out.println("[runner] initialSchemaVersion = " + result.initialSchemaVersion);
        System.out.println("[runner] targetSchemaVersion  = " + result.targetSchemaVersion);
        System.out.println("[runner] migrationsExecuted    = " + result.migrationsExecuted);
        System.out.println("[runner] success               = " + result.success);
        System.out.println("[runner] warnings              = " + result.warnings);

        System.out.println("[runner] ---- flyway_schema_history ----");
        for (MigrationInfo info : flyway.info().all()) {
            System.out.printf("[runner] %-6s %-40s %-12s %-10s %s%n",
                    info.getVersion(), info.getDescription(), info.getType(),
                    info.getState(), info.getScript());
        }
    }
}
