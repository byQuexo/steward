use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{0}: {1}")]
    Io(String, std::io::Error),
    #[error("{0}: {1}")]
    Parse(String, String),
    #[error("profile `{profile}`: {message}")]
    Invalid { profile: String, message: String },
}

impl ConfigError {
    pub(crate) fn invalid(profile: &str, message: impl Into<String>) -> Self {
        ConfigError::Invalid { profile: profile.to_string(), message: message.into() }
    }
}
