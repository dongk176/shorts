import importlib.util
import json
import sys
import types
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

# Pure tests work without cloud credentials or a local AWS SDK installation.
sys.modules.setdefault("boto3", types.SimpleNamespace(client=Mock()))
sys.modules.setdefault("botocore", types.ModuleType("botocore"))
sys.modules.setdefault("botocore.config", types.SimpleNamespace(Config=lambda **kw: kw))
spec = importlib.util.spec_from_file_location(
    "inventory", Path(__file__).with_name("admin_ip_inventory.py")
)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)
NOW = datetime(2026, 10, 5, 12, tzinfo=UTC)


def version(age, identity, current=False):
    return {
        "VersionId": str(age),
        "CreatedDate": NOW - timedelta(hours=age),
        "VersionStages": ["AWSCURRENT"] if current else [],
        "routes": {"webshare-01": identity, "webshare-02": "unchanged"},
    }


class InventoryTest(unittest.TestCase):
    def setUp(self):
        inventory._cache.clear()
        inventory._versions.clear()

    def test_replacement_clips_only_changed_route_and_marks_history_bound(self):
        result = inventory.assignments(
            [version(1, "new", True), version(3, "new"), version(30, "old")], NOW
        )
        self.assertEqual(result[0]["assignedAt"], (NOW - timedelta(hours=3)).isoformat())
        self.assertTrue(result[0]["assignmentExact"])
        self.assertFalse(result[1]["assignmentExact"])
        self.assertEqual(result[1]["assignedAt"], (NOW - timedelta(hours=30)).isoformat())

    def test_returning_ip_does_not_reuse_its_old_history(self):
        result = inventory.assignments(
            [version(1, "same", True), version(2, "other"), version(3, "same")], NOW
        )
        self.assertEqual(result[0]["assignedAt"], (NOW - timedelta(hours=1)).isoformat())

    def test_stage_rollback_is_not_mistaken_for_assignment_date(self):
        with self.assertRaises(ValueError):
            inventory.assignments([version(1, "new"), version(3, "old", True)], NOW)

    def test_no_endpoint_credentials_or_raw_ip_leave_reader(self):
        value = json.dumps(
            {
                "DATABASE_URL": "sensitive-db",
                "INGESTION_PROXY_ROUTES_JSON": json.dumps(
                    [{"id": "webshare-01", "proxy_url": "http://username:password@192.0.2.1:8000"}]
                ),
            }
        )
        result = inventory.fingerprints(value)
        self.assertEqual(len(result["webshare-01"]), 10)
        self.assertNotIn("192.0.2.1", json.dumps(result))
        with self.assertRaises(ValueError):
            inventory.fingerprints(value.replace("192.0.2.1", "rotating.example.test"))

    def test_pagination_and_metadata_change_fail_closed(self):
        versions = [version(1, "a", True), version(2, "b")]
        meta = {
            "VersionIdsToStages": {"1": ["AWSCURRENT"], "2": []},
            "LastChangedDate": versions[0]["CreatedDate"],
        }
        client = Mock()
        client.describe_secret.side_effect = [meta, {**meta, "LastChangedDate": NOW}]
        client.list_secret_version_ids.side_effect = [
            {"Versions": [versions[1]], "NextToken": "next"},
            {"Versions": [versions[0]]},
        ]

        def read(**kw):
            host = "192.0.2.1" if kw["VersionId"] == "1" else "192.0.2.2"
            return {
                "SecretString": json.dumps(
                    {
                        "INGESTION_PROXY_ROUTES_JSON": json.dumps(
                            [{"id": "webshare-01", "proxy_url": "http://" + host}]
                        )
                    }
                )
            }

        client.get_secret_value.side_effect = read
        with self.assertRaises(ValueError):
            inventory.secret_inventory(client, "arn", NOW)
        self.assertEqual(client.list_secret_version_ids.call_args.kwargs["NextToken"], "next")
        self.assertFalse(inventory._cache)

    def test_errors_are_sanitized_and_wrong_account_never_read(self):
        env = {
            "EXPECTED_ACCOUNT": "181651591905",
            "AWS_REGION": "ap-northeast-2",
            "INVENTORY_SECRET_ARNS": "[]",
        }
        with patch.dict("os.environ", env), patch.object(inventory.boto3, "client") as client:
            result = inventory.handler(
                {"targets": ["arn:aws:batch:ap-northeast-2:426197262986:job-definition/test:1"]},
                None,
            )
            self.assertFalse(result["verified"])
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
