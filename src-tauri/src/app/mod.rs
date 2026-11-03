pub mod commands;
pub mod config;
pub mod external;

pub mod gitlog;
pub mod logging;
pub mod platform;
mod state;
pub mod terminal;
pub mod update;
pub mod watch;

pub use state::AppState;
