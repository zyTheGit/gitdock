pub mod commands;
pub mod config;
pub mod external;
pub mod gitconfig;
pub mod logging;
mod state;
pub mod terminal;
pub mod update;
pub mod watch;

pub use state::AppState;
