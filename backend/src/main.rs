mod models;
mod database;
mod algorithms;
mod alerts;
mod handlers;

use actix_web::{App, HttpServer, middleware, web};
use actix_cors::Cors;
use std::env;
use std::io;
use std::path::PathBuf;
use actix_files as fs;
use env_logger::Env;

#[actix_web::main]
async fn main() -> io::Result<()> {
    env_logger::Builder::from_env(Env::default().default_filter_or("info,relic_monitor_backend=debug")).init();

    dotenv::dotenv().ok();

    let host = env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = env::var("SERVER_PORT").unwrap_or_else(|_| "8080".to_string()).parse::<u16>().unwrap_or(8080);

    let influx_url = env::var("INFLUXDB_URL").unwrap_or_else(|_| "http://127.0.0.1:8086".to_string());
    let influx_db = env::var("INFLUXDB_DB").unwrap_or_else(|_| "relic_monitor".to_string());
    let influx_user = env::var("INFLUXDB_USER").unwrap_or_else(|_| "writer".to_string());
    let influx_pass = env::var("INFLUXDB_PASS").unwrap_or_else(|_| "writer_relic_2026".to_string());

    let db = database::Database::new(&influx_url, &influx_db, &influx_user, &influx_pass);
    if let Err(e) = db.init_default_data().await {
        eprintln!("初始化默认数据警告: {:?}", e);
    }

    let alert_config = alerts::AlertConfig::default();
    let alert_manager = alerts::AlertManager::new(alert_config);

    let db_data = web::Data::new(db.clone());
    let alert_data = web::Data::new(alert_manager.clone());

    let frontend_dir = PathBuf::from(env::var("FRONTEND_DIR")
        .unwrap_or_else(|_| "../frontend".to_string()));

    let bind_addr = format!("{}:{}", host, port);
    println!("============================================================");
    println!("  古代骨角质文物埋藏腐蚀界面监测系统 - 后端服务");
    println!("  Rust Actix-Web v4  |  InfluxDB 1.8  |  API Server");
    println!("============================================================");
    println!("  服务地址:   http://{}", bind_addr);
    println!("  InfluxDB:   {} ({})", influx_url, influx_db);
    println!("  传感器:     50 pH + 50 ORP + 30 Ca²+ = 130台");
    println!("  文物数量:   500件 (旧石器时代骨角质)");
    println!("  采集周期:   30分钟/次 (LoRa)");
    println!("  告警阈值:   pH<5.5 | Ca²+>200ppm");
    println!("  推送通道:   短信 + 钉钉 + 控制台");
    println!("============================================================");

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(middleware::Logger::default())
            .wrap(middleware::Compress::default())
            .wrap(cors)
            .app_data(db_data.clone())
            .app_data(alert_data.clone())
            .configure(handlers::configure_routes)
            .service(
                fs::Files::new("/", frontend_dir.clone())
                    .index_file("index.html")
                    .use_last_modified(true)
            )
    })
    .bind(&bind_addr)?
    .workers(num_cpus::get())
    .run()
    .await
}
