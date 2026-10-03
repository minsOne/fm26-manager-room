/// Nation labels are only exposed when the small FM nation id has an
/// independently checked mapping. Unknown ids remain numeric in the snapshot.
pub fn verified_name(nation_id: u32) -> Option<&'static str> {
    match nation_id {
        // Verified in CI against the public FM26 fixture using multiple
        // Saudi clubs from the reference reader. See verify_saudi_nation_mapping.py.
        133 => Some("Saudi Arabia"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_verified_names_are_labeled() {
        assert_eq!(verified_name(133), Some("Saudi Arabia"));
        assert_eq!(verified_name(1), None);
        assert_eq!(verified_name(999), None);
    }
}
